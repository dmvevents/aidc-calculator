// App engine: builds each calculator's input form from its section config
// (sections.js), recomputes live, renders outputs + derivation chains,
// encodes state in the URL hash, handles unit toggles and Copy-as-Markdown.
// Vanilla JS, no libraries. Sections register via AIDC.registerSections().
"use strict";
(function () {
  const A = globalThis.AIDC;
  const disp = () => A.res.disp;
  const fmt = () => A.res.fmt;

  // ---- unit display conversions (display layer only; engines stay native) --
  const UNIT_GROUPS = {
    power: { label: ["kW", "MW"], conv: { kW: (v) => v / 1000, "kW-IT": (v) => v / 1000 },
             rename: { kW: "MW", "kW-IT": "MW-IT" } },
    flow: { label: ["LPM", "GPM"], conv: { LPM: (v) => v * 0.264172, "LPM/kW": (v) => v * 0.264172 },
            rename: { LPM: "GPM", "LPM/kW": "GPM/kW" } },
    area: { label: ["m2", "ft2"], conv: { m2: (v) => v * 10.76391 }, rename: { m2: "ft2" } },
  };

  const state = { sections: [], units: {}, results: {}, hashTimer: null, restoring: false };

  function chipEl(label, src, title) {
    const a = document.createElement("a");
    const l = label.replace(/[\[\]]/g, "");
    a.className = "chip chip-" + l.toLowerCase();
    a.href = "sources.html#" + (src || "legend");
    a.textContent = l;
    a.title = (title ? title + " — " : "") + ({ S: "stated: cited source", D: "derived: arithmetic shown", A: "assumed: verify per project" })[l];
    a.setAttribute("aria-label", ({ S: "stated", D: "derived", A: "assumed" })[l] + " — view source");
    return a;
  }

  // ---- field factory --------------------------------------------------------
  function buildField(sec, f) {
    const wrap = document.createElement("label");
    wrap.className = "field";
    const head = document.createElement("span");
    head.className = "field-label";
    head.append(f.label.toUpperCase());
    const dflt = sec.defaults[f.key];
    if (dflt) head.appendChild(chipEl(dflt.label, f.src, dflt.source));
    wrap.appendChild(head);

    let ctl;
    if (f.type === "select") {
      ctl = document.createElement("select");
      for (const opt of f.options) {
        const o = document.createElement("option");
        o.value = String(opt[0]);
        o.textContent = opt[1];
        ctl.appendChild(o);
      }
      if (dflt && dflt.value !== null && dflt.value !== undefined) ctl.value = String(dflt.value);
      if (f.value !== undefined) ctl.value = String(f.value);
    } else if (f.type === "checkbox") {
      ctl = document.createElement("input");
      ctl.type = "checkbox";
      ctl.checked = !!(dflt && dflt.value);
    } else {
      // text + inputmode, not type=number: no spinner or scroll-to-increment
      // hazards; bounds are enforced in collect(). Fields that may go negative
      // get no inputmode — the iOS decimal keypad has no minus sign.
      ctl = document.createElement("input");
      ctl.type = "text";
      ctl.autocomplete = "off";
      if (f.min !== undefined && f.min >= 0) {
        ctl.inputMode = f.step === 1 ? "numeric" : "decimal";
      }
      const pv = f.value !== undefined ? f.value : (dflt ? dflt.value : null);
      ctl.placeholder = pv === null || pv === undefined ? (f.placeholder || "optional") : String(pv);
    }
    ctl.id = sec.id + "." + f.key;
    ctl.dataset.c = sec.id;
    ctl.dataset.k = f.key;
    if (f.type === "select" && f.numeric) ctl.dataset.num = "1";
    ctl.addEventListener("input", () => onInput(sec));
    ctl.addEventListener("change", () => onInput(sec));
    const row = document.createElement("span");
    row.className = "field-row";
    row.appendChild(ctl);
    if (f.unit || (dflt && dflt.unit)) {
      const u = document.createElement("span");
      u.className = "field-unit";
      u.textContent = f.unit || dflt.unit;
      row.appendChild(u);
    }
    wrap.appendChild(row);
    const err = document.createElement("span");
    err.className = "field-err";
    err.id = ctl.id + "-err";
    err.setAttribute("role", "alert");
    ctl.setAttribute("aria-describedby", err.id);
    wrap.appendChild(err);
    return wrap;
  }

  function buildForm(sec) {
    const mount = document.getElementById(sec.id + "-inputs");
    if (!mount) return;
    const prim = document.createElement("div");
    prim.className = "fields";
    for (const f of sec.fields.filter((x) => !x.advanced)) prim.appendChild(buildField(sec, f));
    mount.appendChild(prim);
    const adv = sec.fields.filter((x) => x.advanced);
    if (adv.length) {
      const det = document.createElement("details");
      det.className = "adv";
      const sum = document.createElement("summary");
      sum.textContent = "All parameters (" + adv.length + ")";
      det.appendChild(sum);
      const grid = document.createElement("div");
      grid.className = "fields";
      for (const f of adv) grid.appendChild(buildField(sec, f));
      det.appendChild(grid);
      mount.appendChild(det);
    }
    if (sec.unitToggles && sec.unitToggles.length) {
      const bar = document.createElement("div");
      bar.className = "unitbar";
      for (const g of sec.unitToggles) {
        const grp = UNIT_GROUPS[g];
        const fs = document.createElement("fieldset");
        fs.className = "seg";
        const lg = document.createElement("legend");
        lg.textContent = g === "power" ? "power units" : g === "flow" ? "flow units" : "area units";
        fs.appendChild(lg);
        grp.label.forEach((lab, i) => {
          const id = sec.id + "-u-" + g + "-" + i;
          const r = document.createElement("input");
          r.type = "radio"; r.name = sec.id + "-u-" + g; r.id = id; r.value = i ? "alt" : "base";
          if (!i) r.checked = true;
          r.addEventListener("change", () => {
            state.units[sec.id + "." + g] = r.value === "alt";
            renderSection(sec); scheduleHash();
          });
          const l = document.createElement("label");
          l.htmlFor = id; l.textContent = lab;
          fs.append(r, l);
        });
        bar.appendChild(fs);
      }
      mount.appendChild(bar);
    }
  }

  // ---- collect + compute ----------------------------------------------------
  function collect(sec) {
    const kw = {};
    let bad = false;
    for (const f of sec.fields) {
      const ctl = document.getElementById(sec.id + "." + f.key);
      if (!ctl) continue;
      const errEl = ctl.closest(".field").querySelector(".field-err");
      errEl.textContent = "";
      ctl.closest(".field").classList.remove("is-err");
      if (f.type === "checkbox") {
        const dflt = sec.defaults[f.key];
        if (!!ctl.checked !== !!(dflt && dflt.value)) kw[f.key] = ctl.checked;
        continue;
      }
      if (f.type === "select") {
        let v = ctl.value;
        if (v === "") continue;
        if (ctl.dataset.num) v = Number(v);
        if (v === "null") v = null;
        const dflt = sec.defaults[f.key];
        if (!dflt || v !== dflt.value) kw[f.key] = v;
        continue;
      }
      const raw = ctl.value.trim();
      if (raw === "") continue;              // empty = use default
      const v = Number(raw);
      let msg = "";
      if (!isFinite(v)) {
        msg = "enter a number";
      } else if ((f.min !== undefined && v < f.min) || (f.max !== undefined && v > f.max)) {
        msg = f.min !== undefined && f.max !== undefined ? "enter " + f.min + "–" + f.max
            : f.min !== undefined ? "enter ≥ " + f.min : "enter ≤ " + f.max;
      }
      if (msg) {
        errEl.textContent = msg + " — using the default";
        ctl.closest(".field").classList.add("is-err");
        bad = true;
        continue;
      }
      kw[f.key] = v;
    }
    return { kw: kw, bad: bad };
  }

  function onInput(sec) {
    renderSection(sec);
    scheduleHash();
  }

  // ---- output rendering ------------------------------------------------------
  function unitView(sec, qty) {
    let v = qty.value, u = qty.unit;
    for (const g of sec.unitToggles || []) {
      if (!state.units[sec.id + "." + g]) continue;
      const grp = UNIT_GROUPS[g];
      if (typeof v === "number" && grp.conv[u]) {
        v = grp.conv[u](v);
        u = grp.rename[u];
      }
    }
    return { v: v, u: u };
  }

  function renderSection(sec) {
    const got = collect(sec);
    let res;
    try {
      res = sec.compute(got.kw);
    } catch (e) {
      const heroEl = document.getElementById(sec.id + "-hero");
      if (heroEl) {
        heroEl.replaceChildren();
        const lab = document.createElement("span");
        lab.className = "hero-label";
        lab.textContent = "check inputs";
        const msg = document.createElement("span");
        msg.className = "hero-err";
        msg.textContent = String(e.message || e);
        heroEl.append(lab, msg);
      }
      return;
    }
    state.results[sec.id] = { res: res, kw: got.kw };

    // hero stat tile
    const hero = document.getElementById(sec.id + "-hero");
    if (hero && sec.hero) {
      const hq = res.outputs[sec.hero];
      const uv = unitView(sec, hq);
      hero.replaceChildren();
      const lab = document.createElement("span");
      lab.className = "hero-label";
      lab.textContent = sec.heroLabel || sec.hero.replace(/_/g, " ");
      const val = document.createElement("span");
      val.className = "hero-value";
      val.textContent = disp()(uv.v);
      const un = document.createElement("span");
      un.className = "hero-unit";
      un.append(uv.u + " ");
      un.appendChild(chipEl(hq.label, sec.heroSrc, hq.source));
      hero.append(lab, val, un);
    }

    // derivation chain — the governing formulas with actual numbers substituted
    const der = document.getElementById(sec.id + "-derive");
    if (der && sec.derive) {
      der.replaceChildren();
      for (const line of sec.derive(res, got.kw)) {
        const d = document.createElement("div");
        d.className = "derive-line";
        d.textContent = line;
        der.appendChild(d);
      }
    }

    // outputs table
    const tbl = document.getElementById(sec.id + "-out");
    if (tbl) {
      tbl.replaceChildren();
      // sr-only header row so every td has a th (a11y: td-has-header)
      const table = tbl.closest("table");
      if (table && !table.tHead) {
        const th = table.createTHead();
        th.className = "sr-head";
        const row = th.insertRow();
        for (const t of ["output — derivation", "value", "unit", "provenance"]) {
          const c = document.createElement("th");
          c.scope = "col";
          c.textContent = t;
          row.appendChild(c);
        }
      }
      for (const [k, qv] of Object.entries(res.outputs)) {
        if (qv.value === null || qv.value === undefined) continue;
        const uv = unitView(sec, qv);
        const tr = document.createElement("tr");
        const td1 = document.createElement("td");
        const nm = document.createElement("span");
        nm.className = "out-name";
        nm.textContent = k;
        const src = document.createElement("span");
        src.className = "out-src";
        src.textContent = qv.source;
        td1.append(nm, src);
        const td2 = document.createElement("td");
        td2.className = "num";
        if (typeof uv.v === "boolean") {
          // Design-dial bools (e.g. fabric_non_blocking) are NOT pass/fail — an
          // oversubscribed fabric is an intentional taper, not a failure. Render
          // them neutrally so they don't read as a red "FAIL" beside a genuine
          // verdict like channel_il_pass (queue #8 antagonist HIGH-1). Real
          // verdicts (*_pass, *_ok, *_within_*, n_minus_1_ok, ...) keep the badge.
          const NEUTRAL_BOOLS = new Set(["fabric_non_blocking"]);
          if (NEUTRAL_BOOLS.has(k)) {
            td2.textContent = uv.v ? "yes" : "no";
          } else {
            const b = document.createElement("span");
            b.className = "verdict " + (uv.v ? "v-good" : "v-bad");
            b.textContent = uv.v ? "✓ PASS" : "✕ FAIL";
            td2.appendChild(b);
          }
        } else {
          td2.textContent = disp()(uv.v);
        }
        const td3 = document.createElement("td");
        td3.className = "unit-cell";
        td3.textContent = uv.u;
        const td4 = document.createElement("td");
        td4.appendChild(chipEl(qv.label, sec.outSrc && sec.outSrc[k], null));
        tr.append(td1, td2, td3, td4);
        tbl.appendChild(tr);
      }
    }

    // notes
    const notes = document.getElementById(sec.id + "-notes");
    if (notes) {
      notes.replaceChildren();
      for (const n of res.notes) {
        const li = document.createElement("li");
        li.textContent = n;
        if (/INFEASIBLE|UNDER-RATED|WARNING|EXCEEDS|FAILS|ABOVE THE PRODUCT/.test(n)) li.className = "note-bad";
        notes.appendChild(li);
      }
    }

    if (sec.after) sec.after(res, got.kw);
  }

  // ---- URL-hash shareable state ---------------------------------------------
  // buildHashString reads field state WITHOUT touching location — pages that
  // pre-fill gallery presets use it to build deep links while keeping the
  // "boot never writes the hash" convention.
  function buildHashString() {
    const ps = new URLSearchParams();
    for (const sec of state.sections) {
      for (const f of sec.fields) {
        const ctl = document.getElementById(sec.id + "." + f.key);
        if (!ctl) continue;
        // scenario-bar-seeded fields are NOT explicit user state: the s.*
        // namespace carries them, so a restored link re-derives them as
        // bar-owned instead of freezing them as user values (antagonist A-02)
        if (ctl.dataset && ctl.dataset.scen === "1") continue;
        if (f.type === "checkbox") {
          const dflt = sec.defaults[f.key];
          if (!!ctl.checked !== !!(dflt && dflt.value)) ps.set(ctl.id, ctl.checked ? "1" : "0");
        } else if (f.type === "select") {
          const dflt = sec.defaults[f.key];
          const dv = dflt && dflt.value !== null && dflt.value !== undefined ? String(dflt.value) : "";
          // fields whose default comes from the field config (f.value), not the
          // engine defaults — the rack platform select (C1: was `variant`)
          const cfgDefault = f.value !== undefined;
          if (ctl.value !== dv && ctl.value !== "" && !cfgDefault) ps.set(ctl.id, ctl.value);
          if (cfgDefault && ctl.value !== String(f.value)) ps.set(ctl.id, ctl.value);
        } else if (ctl.value.trim() !== "") {
          ps.set(ctl.id, ctl.value.trim());
        }
      }
      for (const g of sec.unitToggles || []) {
        if (state.units[sec.id + "." + g]) ps.set("u." + sec.id + "." + g, "1");
      }
    }
    if (A.scenario) {
      for (const [k, v] of A.scenario.hashPairs()) ps.set(k, v);
    }
    return ps.toString();
  }
  function encodeHash() {
    const s = buildHashString();
    history.replaceState(null, "", s ? "#" + s : location.pathname);
  }
  function scheduleHash() {
    if (state.restoring) return;
    clearTimeout(state.hashTimer);
    state.hashTimer = setTimeout(encodeHash, 150);
  }
  function restoreHash() {
    if (!location.hash || location.hash.length < 2) return;
    state.restoring = true;
    const ps = new URLSearchParams(location.hash.slice(1));
    // scenario first-pass: reads s.* (and migrates legacy keys inside ps)
    if (A.scenario) A.scenario.restoreFromHash(ps);
    for (const [k, v] of ps.entries()) {
      if (k.startsWith("s.")) continue;    // scenario namespace, handled above
      if (k.startsWith("u.")) {
        const parts = k.slice(2);
        state.units[parts] = v === "1";
        const [secId, g] = parts.split(".");
        const alt = document.querySelector("input[name='" + secId + "-u-" + g + "'][value='alt']");
        if (alt && v === "1") alt.checked = true;
        continue;
      }
      const ctl = document.getElementById(k);
      if (!ctl) continue;
      if (ctl.type === "checkbox") ctl.checked = v === "1";
      else ctl.value = v;
      ctl.dispatchEvent(new Event("change"));
    }
    state.restoring = false;
  }

  // ---- Copy as Markdown -------------------------------------------------------
  function copyMarkdown(sec) {
    const st = state.results[sec.id];
    if (!st) return;
    const r = st.res;
    const L = [];
    L.push("## " + r.title);
    L.push("");
    L.push("method: " + r.method);
    L.push("");
    L.push("| input | value | unit | label | source |");
    L.push("|---|---:|---|---|---|");
    for (const [k, qv] of Object.entries(r.inputs)) {
      L.push("| " + k + " | " + fmt()(qv.value) + " | " + qv.unit + " | " + qv.label + " | " + qv.source.replace(/\|/g, "/") + " |");
    }
    L.push("");
    L.push("| output | value | unit | label | derivation |");
    L.push("|---|---:|---|---|---|");
    for (const [k, qv] of Object.entries(r.outputs)) {
      L.push("| " + k + " | " + fmt()(qv.value) + " | " + qv.unit + " | " + qv.label + " | " + qv.source.replace(/\|/g, "/") + " |");
    }
    if (sec.derive) {
      L.push("");
      L.push("Derivation chain:");
      for (const d of sec.derive(r, st.kw)) L.push("- " + d);
    }
    L.push("");
    L.push("Notes:");
    for (const n of r.notes) L.push("- " + n);
    L.push("");
    L.push("Generated by the AI-DC calculator (engineering estimator, not an offer or design of record). " +
           "Shareable state: " + location.href);
    const text = L.join("\n");
    const done = (ok) => {
      const btn = document.getElementById(sec.id + "-copy");
      if (!btn) return;
      const old = btn.textContent;
      btn.textContent = ok ? "Copied ✓" : "Copy failed";
      setTimeout(() => { btn.textContent = old; }, 1600);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => done(true), () => done(false));
    } else {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      ta.remove();
      done(ok);
    }
  }

  // ---- sticky-nav active highlight -------------------------------------------
  // Nav clicks scroll WITHOUT touching the hash — the hash belongs to state.
  function navHighlight() {
    const links = Array.from(document.querySelectorAll(".nav a[href^='#']"));
    for (const a of links) {
      a.addEventListener("click", (ev) => {
        const t = document.getElementById(a.getAttribute("href").slice(1));
        if (t) { ev.preventDefault(); t.scrollIntoView({ behavior: "smooth", block: "start" }); }
      });
    }
    const map = new Map(links.map((a) => [a.getAttribute("href").slice(1), a]));
    const obs = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const a = map.get(e.target.id);
        if (a && e.isIntersecting) {
          links.forEach((x) => x.classList.remove("is-active"));
          a.classList.add("is-active");
        }
      }
    }, { rootMargin: "-30% 0px -60% 0px" });
    for (const id of map.keys()) {
      const t = document.getElementById(id);
      if (t) obs.observe(t);
    }
  }

  // nav overflow affordance (v3.6.2 A-08): fade-mask ONLY when there is
  // actually more nav to scroll — a static mask erased glyphs on wide screens.
  function navOverflowToggle() {
    const inner = document.querySelector(".nav-inner");
    if (!inner) return;
    const on = inner.scrollWidth > inner.clientWidth + 2;
    inner.classList.toggle("nav-overflow", on);
  }
  window.addEventListener("resize", navOverflowToggle);
  if (document.readyState !== "loading") navOverflowToggle();
  else document.addEventListener("DOMContentLoaded", navOverflowToggle);

  // ---- boot --------------------------------------------------------------------
  A.registerSections = function (sections) {
    state.sections = sections;
    for (const sec of sections) {
      buildForm(sec);
      const btn = document.getElementById(sec.id + "-copy");
      if (btn) btn.addEventListener("click", () => copyMarkdown(sec));
      if (sec.init) sec.init();
    }
    // shared scenario bar (v3.1): built before restoreHash so the s.* pass can
    // sync it; bootApply pre-populates DEFAULT fields after explicit hash
    // values landed (they win), without writing the hash
    if (A.scenario) A.scenario.buildScenarioBar();
    restoreHash();
    if (A.scenario) A.scenario.bootApply();
    for (const sec of sections) renderSection(sec);
    navHighlight();
  };
  // v2 multi-page: each page's page_*.js pushes its section(s) then calls boot.
  A.boot = function () {
    A.registerSections(A.SECTIONS || []);
  };
  // print: expand collapsed derivation chains for the paper copy, restore after
  let printOpened = null;
  window.addEventListener("beforeprint", () => {
    printOpened = Array.from(document.querySelectorAll("details:not([open])"));
    for (const d of printOpened) d.open = true;
  });
  window.addEventListener("afterprint", () => {
    for (const d of printOpened || []) d.open = false;
    printOpened = null;
  });
  A.rerender = function (id) {
    const sec = state.sections.find((s) => s.id === id);
    if (sec) { renderSection(sec); scheduleHash(); }
  };
  A.scheduleHash = scheduleHash;
  A.chipEl = chipEl;
  A.stateHash = buildHashString;
  A.appState = state;
})();
