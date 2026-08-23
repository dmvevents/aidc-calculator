// Page script: risks.html — the failure-mode explorer. Renders the generated
// RISKSDATA corpus (risksdata.js, built deterministically from the generic
// FMEA research) as a filterable / sortable / expandable table: filter by the
// 11 building systems, the 3 phases and free text over name + mechanism +
// detection; every row expands to mechanism → presents → detection →
// prevention → recovery with source citations that deep-link into
// sources.html. Filter state lives in the URL hash (site convention).
// Vanilla JS, no libraries.
"use strict";
(function () {
  const R = globalThis.RISKSDATA;
  if (!R) return;
  const A = globalThis.AIDC || {};
  const SYS_NAME = {};
  for (const s of R.systems) SYS_NAME[s.id] = s.name;

  const state = { sys: "", phases: new Set(R.phases), q: "", sort: "id", dir: 1 };
  const FM_RE = /FM-[A-Z]{3}-\d{3}/g;

  // non-interactive by design: the chip sits INSIDE the row's expand button,
  // so a nested link would fail a11y (nested controls / 24px target size);
  // the expanded detail's source-cite links carry the deep links instead.
  function chip(prim) {
    const s = document.createElement("span");
    s.className = "chip chip-" + prim.toLowerCase();
    s.textContent = prim;
    s.title = { S: "primary evidence: published source", D: "primary evidence: derived from sourced aggregates",
                A: "primary evidence: practitioner class — verify per project" }[prim];
    return s;
  }

  // linkify FM-XXX-NNN cross-references without innerHTML (text may contain <>)
  function fmText(s) {
    const frag = document.createDocumentFragment();
    let last = 0;
    for (const m of s.matchAll(FM_RE)) {
      frag.append(s.slice(last, m.index));
      const id = m[0];
      if (byId[id]) {
        const a = document.createElement("a");
        a.href = "#open=" + id;
        a.textContent = id;
        a.addEventListener("click", (ev) => { ev.preventDefault(); openMode(id, true); });
        frag.append(a);
      } else {
        frag.append(id);
      }
      last = m.index + id.length;
    }
    frag.append(s.slice(last));
    return frag;
  }

  const tbody = document.getElementById("risk-tbody");
  const byId = {};
  const rows = [];

  function buildRows() {
    for (const m of R.modes) {
      byId[m.id] = m;
      const tr = document.createElement("tr");
      tr.className = "risk-row";
      tr.id = "r-" + m.id;
      const tdId = document.createElement("td");
      tdId.className = "mono risk-id";
      tdId.textContent = m.id;
      const tdSys = document.createElement("td");
      tdSys.className = "risk-sys";
      tdSys.textContent = SYS_NAME[m.sys];
      const tdName = document.createElement("td");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "risk-toggle";
      btn.setAttribute("aria-expanded", "false");
      btn.setAttribute("aria-controls", "d-" + m.id);
      btn.append(m.name + " ");
      btn.appendChild(chip(m.prim));
      tdName.appendChild(btn);
      const tdPh = document.createElement("td");
      tdPh.className = "risk-ph micro";
      tdPh.textContent = m.phases.map((p) => p.slice(0, 3)).join(" · ");
      tr.append(tdId, tdSys, tdName, tdPh);

      const dtr = document.createElement("tr");
      dtr.className = "risk-detail";
      dtr.id = "d-" + m.id;
      dtr.hidden = true;
      const dtd = document.createElement("td");
      dtd.colSpan = 4;
      const dl = document.createElement("dl");
      dl.className = "risk-dl";
      for (const [k, lab] of [["mechanism", "Mechanism"], ["presents", "Presents as"],
                              ["detection", "Detection"], ["prevention", "Prevention / spec hook"],
                              ["recovery", "Recovery"]]) {
        const dt = document.createElement("dt");
        dt.textContent = lab;
        const dd = document.createElement("dd");
        dd.appendChild(fmText(m.f[k]));
        dl.append(dt, dd);
      }
      const dt = document.createElement("dt");
      dt.textContent = "Sources";
      const dd = document.createElement("dd");
      dd.append(m.f.source + " ");
      for (const c of m.cites) {
        const a = document.createElement("a");
        a.className = "risk-cite";
        a.href = "sources.html#" + c;
        a.textContent = (R.citeLabels && R.citeLabels[c]) || c;
        dd.append(a);
      }
      dl.append(dt, dd);
      dtd.appendChild(dl);
      dtr.appendChild(dtd);

      btn.addEventListener("click", () => {
        const open = dtr.hidden;
        dtr.hidden = !open;
        btn.setAttribute("aria-expanded", open ? "true" : "false");
      });
      tbody.append(tr, dtr);
      rows.push({ m: m, tr: tr, dtr: dtr, btn: btn,
                  hay: (m.name + " " + m.f.mechanism + " " + m.f.detection).toLowerCase() });
    }
  }

  function openMode(id, scroll) {
    const rec = rows.find((x) => x.m.id === id);
    if (!rec) return;
    if (rec.tr.classList.contains("is-hidden")) {
      state.sys = "";
      state.q = "";
      state.phases = new Set(R.phases);
      reflectControls();
      applyFilter();
    }
    rec.dtr.hidden = false;
    rec.btn.setAttribute("aria-expanded", "true");
    if (scroll) rec.tr.scrollIntoView({ block: "center" });
  }

  function applyFilter() {
    let shown = 0;
    const q = state.q.toLowerCase();
    for (const rec of rows) {
      const okSys = !state.sys || rec.m.sys === state.sys;
      const okPh = rec.m.phases.some((p) => state.phases.has(p));
      const okQ = !q || rec.hay.includes(q);
      const ok = okSys && okPh && okQ;
      rec.tr.classList.toggle("is-hidden", !ok);
      if (!ok) {
        rec.dtr.hidden = true;
        rec.btn.setAttribute("aria-expanded", "false");
      }
      rec.dtr.classList.toggle("is-hidden", !ok);
      if (ok) shown++;
    }
    const n = document.getElementById("risk-count");
    if (n) n.textContent = "showing " + shown + " of " + R.modes.length + " failure modes";
    scheduleHash();
  }

  function applySort() {
    const key = state.sort, dir = state.dir;
    const sorted = rows.slice().sort((a, b) => {
      const va = key === "name" ? a.m.name : key === "sys" ? a.m.sys + a.m.id : a.m.id;
      const vb = key === "name" ? b.m.name : key === "sys" ? b.m.sys + b.m.id : b.m.id;
      return dir * va.localeCompare(vb);
    });
    for (const rec of sorted) tbody.append(rec.tr, rec.dtr);
    for (const th of document.querySelectorAll("#risk-table th[data-sort]")) {
      th.setAttribute("aria-sort", th.dataset.sort === key
        ? (dir === 1 ? "ascending" : "descending") : "none");
    }
    scheduleHash();
  }

  // ---- system × phase matrix (computed at build time; click row = filter) ----
  function buildMatrix() {
    const mount = document.getElementById("risk-matrix");
    if (!mount) return;
    for (const s of R.systems) {
      const mrow = R.matrix[s.id];
      const tr = document.createElement("tr");
      const th = document.createElement("th");
      th.scope = "row";
      const b = document.createElement("button");
      b.type = "button";
      b.className = "risk-mx-btn";
      b.textContent = s.id + " · " + s.name;
      b.title = s.scope;
      b.addEventListener("click", () => {
        state.sys = state.sys === s.id ? "" : s.id;
        reflectControls();
        applyFilter();
        document.getElementById("risk-table").scrollIntoView({ block: "start" });
      });
      th.appendChild(b);
      tr.appendChild(th);
      for (const v of [mrow.modes, mrow.INSTALL, mrow.COMMISSION, mrow.OPERATE]) {
        const td = document.createElement("td");
        td.className = "num";
        td.textContent = v;
        tr.appendChild(td);
      }
      mount.appendChild(tr);
    }
  }

  // ---- controls + URL-hash state ----------------------------------------------
  let hashTimer = null, restoring = false;
  function scheduleHash() {
    if (restoring) return;
    clearTimeout(hashTimer);
    hashTimer = setTimeout(() => {
      const ps = new URLSearchParams();
      if (state.sys) ps.set("sys", state.sys);
      if (state.phases.size !== R.phases.length) ps.set("ph", Array.from(state.phases).join(","));
      if (state.q) ps.set("q", state.q);
      if (state.sort !== "id" || state.dir !== 1) {
        ps.set("sort", state.sort);
        ps.set("dir", state.dir === 1 ? "a" : "d");
      }
      const s = ps.toString();
      history.replaceState(null, "", s ? "#" + s : location.pathname);
    }, 150);
  }
  function restoreHash() {
    if (!location.hash || location.hash.length < 2) return;
    restoring = true;
    const ps = new URLSearchParams(location.hash.slice(1));
    if (ps.get("sys") && SYS_NAME[ps.get("sys")]) state.sys = ps.get("sys");
    if (ps.get("ph")) {
      const on = ps.get("ph").split(",").filter((p) => R.phases.includes(p));
      if (on.length) state.phases = new Set(on);
    }
    if (ps.get("q")) state.q = ps.get("q");
    if (ps.get("sort") && ["id", "sys", "name"].includes(ps.get("sort"))) state.sort = ps.get("sort");
    if (ps.get("dir") === "d") state.dir = -1;
    restoring = false;
    const open = ps.get("open");
    if (open) setTimeout(() => openMode(open, true), 0);
  }
  function reflectControls() {
    const sel = document.getElementById("risk-sys");
    if (sel) sel.value = state.sys;
    for (const p of R.phases) {
      const cb = document.getElementById("risk-ph-" + p);
      if (cb) cb.checked = state.phases.has(p);
    }
    const q = document.getElementById("risk-q");
    if (q) q.value = state.q;
  }
  function wireControls() {
    const sel = document.getElementById("risk-sys");
    for (const s of R.systems) {
      const o = document.createElement("option");
      o.value = s.id;
      o.textContent = s.id + " — " + s.name;
      sel.appendChild(o);
    }
    sel.addEventListener("change", () => { state.sys = sel.value; applyFilter(); });
    for (const p of R.phases) {
      const cb = document.getElementById("risk-ph-" + p);
      cb.addEventListener("change", () => {
        if (cb.checked) state.phases.add(p); else state.phases.delete(p);
        applyFilter();
      });
    }
    const q = document.getElementById("risk-q");
    q.addEventListener("input", () => { state.q = q.value.trim(); applyFilter(); });
    for (const th of document.querySelectorAll("#risk-table th[data-sort]")) {
      const b = th.querySelector("button");
      b.addEventListener("click", () => {
        if (state.sort === th.dataset.sort) state.dir = -state.dir;
        else { state.sort = th.dataset.sort; state.dir = 1; }
        applySort();
      });
    }
    const x = document.getElementById("risk-expand-all");
    if (x) x.addEventListener("click", () => {
      const anyClosed = rows.some((r) => !r.tr.classList.contains("is-hidden") && r.dtr.hidden);
      for (const r of rows) {
        if (r.tr.classList.contains("is-hidden")) continue;
        r.dtr.hidden = !anyClosed;
        r.btn.setAttribute("aria-expanded", anyClosed ? "true" : "false");
      }
      x.textContent = anyClosed ? "Collapse all" : "Expand all";
    });
  }

  // ---- masthead stats -----------------------------------------------------------
  function stats() {
    const n = document.getElementById("risk-hero-n");
    if (n) n.textContent = String(R.modes.length);
    const t = document.getElementById("risk-tally");
    if (t) t.textContent = "[S] " + R.meta.tally.S + " · [D] " + R.meta.tally.D +
                           " · [A] " + R.meta.tally.A + " primary evidence";
  }

  // "top failure classes" cards jump-filter the table (system or text filter)
  document.addEventListener("click", (ev) => {
    const t = ev.target.closest("[data-sys-jump],[data-q-jump]");
    if (!t) return;
    ev.preventDefault();
    state.sys = t.getAttribute("data-sys-jump") || "";
    state.q = t.getAttribute("data-q-jump") || "";
    reflectControls();
    applyFilter();
    document.getElementById("risk-table").scrollIntoView({ block: "start" });
  });

  buildRows();
  buildMatrix();
  wireControls();
  stats();
  restoreHash();
  reflectControls();
  applyFilter();
  applySort();
  // print: expose every visible row's detail (restored after)
  let printOpened = null;
  window.addEventListener("beforeprint", () => {
    printOpened = rows.filter((r) => r.dtr.hidden);
    for (const r of printOpened) r.dtr.hidden = false;
  });
  window.addEventListener("afterprint", () => {
    for (const r of printOpened || []) r.dtr.hidden = true;
    printOpened = null;
  });
})();
