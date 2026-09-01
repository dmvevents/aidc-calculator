// Shared scenario bar (v3.1 Lane 3, audit-v3.1 Fix A, Path 1): one platform +
// size pick drives every calculator page CONSISTENTLY. Lives OUTSIDE the
// section/field/collect/compute pipeline — it only PRE-POPULATES existing
// input elements (never clobbering a hand-typed value) and lets the normal
// pipeline recompute. Zero arithmetic functions are modified.
//
// State: { platform, driver ∈ gpus|mw|racks, target } → deriveScenario() →
// { racks, gpus, it_mw } (round-trip exact). Persisted in localStorage
// `aidc.scenario` (crosses the separate HTML files) and in the URL hash as
// `s.platform / s.driver / s.target` (shareable links). Old `rack.variant=`
// and bare `*.platform=` links keep working via the migration shim.
//
// Ownership rule: a field the bar wrote carries data-scen="1" and may be
// rewritten by the bar; a field the USER typed into (or a hash-restored
// explicit value) never is. Real user input clears the flag (capture-phase
// listener below).
"use strict";
(function () {
  const A = globalThis.AIDC;
  const DB = globalThis.RACKDB;
  if (!A || !DB) return;

  const LS_KEY = "aidc.scenario";
  const PLATFORMS = ["gb200-nvl72", "gb300-nvl72", "b200-liquid", "dgx-b200-aircooled-2su"];
  const DRIVERS = [["gpus", "GPUs"], ["mw", "MW-IT"], ["racks", "racks"]];

  let scen = null;       // {platform, driver, target} or null
  let applying = false;  // true while the bar itself writes fields
  let barEl = null;

  // ---- the derivation (audit 06 §C; identities proven in tools/calc_regression) ----
  // ceil with a scale-aware epsilon: reconstructing racks from racks*k/1000
  // lands 1 ulp above the integer for many (racks, k) pairs and a bare ceil
  // adds a phantom rack (antagonist A-01 — 589/40,000 fuzz failures). Real
  // fractional targets differ from exact multiples by far more than 1e-9.
  const ceilEps = (x) => Math.ceil(x - 1e-9 * Math.max(1.0, Math.abs(x)));
  function deriveScenario(platform, driver, target) {
    const v = DB[platform];
    const g = v.gpus_per_rack, k = v.nameplate_kw;
    let racks;
    if (driver === "gpus") racks = ceilEps(target / g);
    else if (driver === "mw") racks = ceilEps(target * 1000.0 / k);
    else racks = Math.round(target);
    racks = Math.max(1, racks);
    return { racks: racks, gpus: racks * g, it_mw: racks * k / 1000.0 };
  }

  function validScen(s) {
    return s && DB[s.platform] && DRIVERS.some((d) => d[0] === s.driver)
      && isFinite(Number(s.target)) && Number(s.target) > 0;
  }
  function loadStored() {
    try {
      const s = JSON.parse(localStorage.getItem(LS_KEY));
      return validScen(s) ? { platform: s.platform, driver: s.driver, target: Number(s.target) } : null;
    } catch (e) { return null; }
  }
  function save() {
    try {
      if (scen) localStorage.setItem(LS_KEY, JSON.stringify(scen));
      else localStorage.removeItem(LS_KEY);
    } catch (e) { /* storage unavailable — hash still carries state */ }
  }

  // user input (not bar writes) clears bar ownership of a field; a user-toggled
  // checkbox is marked touched so the bar never overrides it
  // (document guard: the node golden-regression harness loads this file headless)
  if (typeof document !== "undefined") document.addEventListener("input", (e) => {
    if (applying || !e.target || !e.target.dataset) return;
    if (e.target.dataset.scen) delete e.target.dataset.scen;
    if (e.target.type === "checkbox") e.target.dataset.scenTouched = "1";
  }, true);

  // ---- field writers (pre-populate ONLY defaults or bar-owned fields) --------
  const fmtNum = (v) => String(Math.round(v * 1e6) / 1e6);
  function writable(ctl) {
    if (!ctl) return false;
    if (ctl.dataset.scen === "1") return true;
    if (ctl.tagName === "SELECT") {
      const dv = ctl.dataset.scenDefault;
      return dv === undefined || ctl.value === dv;
    }
    if (ctl.type === "checkbox") {
      // untouched by user AND not hash-restored to an explicit value
      return ctl.dataset.scenTouched === undefined
        && (ctl.dataset.scenCheckDefault === undefined
            || (ctl.checked ? "1" : "") === ctl.dataset.scenCheckDefault);
    }
    return ctl.value.trim() === "";
  }
  function setNum(secId, key, value) {
    if (value === null || value === undefined || !isFinite(value)) return;
    const ctl = document.getElementById(secId + "." + key);
    if (!ctl || ctl.tagName === "SELECT" || ctl.type === "checkbox" || !writable(ctl)) return;
    applying = true;
    ctl.value = fmtNum(Number(value));
    ctl.dataset.scen = "1";
    ctl.dispatchEvent(new Event("change"));
    applying = false;
  }
  function setSelect(secId, key, value) {
    const ctl = document.getElementById(secId + "." + key);
    if (!ctl || ctl.tagName !== "SELECT") return;
    if (ctl.dataset.scenDefault === undefined) ctl.dataset.scenDefault = ctl.value;
    if (!writable(ctl) || ctl.value === String(value)) return;
    applying = true;
    ctl.value = String(value);
    ctl.dataset.scen = "1";
    ctl.dispatchEvent(new Event("change"));
    applying = false;
  }
  function setCheck(secId, key, value) {
    const ctl = document.getElementById(secId + "." + key);
    if (!ctl || ctl.type !== "checkbox" || !writable(ctl) || ctl.checked === !!value) return;
    if (ctl.dataset.scenCheckDefault === undefined) {
      ctl.dataset.scenCheckDefault = ctl.checked ? "1" : "";
    }
    applying = true;
    ctl.checked = !!value;
    ctl.dataset.scen = "1";
    ctl.dispatchEvent(new Event("change"));
    applying = false;
  }
  function clearField(secId, key) {
    const ctl = document.getElementById(secId + "." + key);
    if (!ctl || ctl.dataset.scen !== "1") return;
    applying = true;
    if (ctl.tagName === "SELECT") ctl.value = ctl.dataset.scenDefault !== undefined ? ctl.dataset.scenDefault : ctl.value;
    else if (ctl.type === "checkbox") ctl.checked = !!ctl.dataset.scenCheckDefault;
    else ctl.value = "";
    delete ctl.dataset.scen;
    ctl.dispatchEvent(new Event("change"));
    applying = false;
  }

  // ---- per-page feeds (audit 06 §C + the per-page platform-propagation list) --
  // Each feed returns note strings for the bar's caveat line. null/absent
  // platform values are SKIPPED (page default stays — stated per platform).
  const FEEDS = {
    power: (d, v) => {
      setNum("power", "it_mw", d.it_mw);
      setNum("power", "pue", v.pue_target);
      setNum("power", "dist_v", v.distribution_voltage_v);
      setNum("power", "gpus", d.gpus);
      setNum("power", "rack_kw", v.nameplate_kw);
      setNum("power", "rack_edpp_kw", v.edpp2_kw);
      setNum("power", "ramp_w_per_sec_per_gpu", v.ramp_w_per_sec_per_gpu);
      setNum("power", "racks_per_path", v.row_plan && v.row_plan.compute);
      const n = [];
      if (v.edpp2_kw == null) n.push("no published EDPP/transient ceiling for this platform — F16 EDPP row off");
      if (v.ramp_w_per_sec_per_gpu == null) n.push("no published per-GPU ramp rate — F16 ramp uses the page default [A]");
      return n;
    },
    cool: (d, v) => {
      setNum("cool", "it_kw", d.it_mw * 1000.0);
      setNum("cool", "liquid_frac", v.liquid_pct / 100.0);
      const n = [];
      if (v.liquid_pct > 0) {
        setNum("cool", "rack_liquid_kw", v.liquid_kw);
        setNum("cool", "cdu_kw", v.cdu_nominal_kw);
        setNum("cool", "tcs_inlet_c", v.design_inlet_c);
        if (v.liquid_flow_curve) {
          setSelect("cool", "flow_basis", "vendor");  // the sourced rack curve governs (F2)
        } else {
          setSelect("cool", "flow_basis", "formula");
          n.push("no vendor flow/PQ curve published for this platform — F1 fixed-ΔT basis; " +
                 "head-loss PQ coefficients remain the NVL72-class curve [A]");
        }
      } else {
        n.push("air-cooled platform: liquid fraction 0 — CDU/TCS rows go dormant, CRAH (F9) carries the load");
      }
      return n;
    },
    rack: (d, v, s) => {
      setSelect("rack", "platform", s.platform);
      setNum("rack", "gpus", d.gpus);
      // same busway row length as the power page (row_plan.compute) — without
      // this the two pages' F17 rows diverged 2x under one pick (antagonist A-09)
      setNum("rack", "racks_per_path", v.row_plan && v.row_plan.compute);
      return [];
    },
    capex: (d, v, s) => {
      setSelect("capex", "platform", s.platform);
      setNum("capex", "it_mw", d.it_mw);
      setNum("capex", "pue", v.pue_target);
      return [];
    },
    colo: (d) => {
      setNum("colo", "it_mw", d.it_mw);
      return [];
    },
    neo: (d, v, s) => {
      setSelect("neo", "platform", s.platform);
      setNum("neo", "it_mw", d.it_mw);
      setNum("neo", "gpus", d.gpus);
      return [];
    },
    land: (d) => {
      setNum("land", "it_mw", d.it_mw);
      return [];
    },
    plan: (d, v, s) => {
      setSelect("plan", "platform", s.platform);
      setNum("plan", "gpus", d.gpus);
      return [];
    },
    fiber: (d, v) => {
      const rps = v.racks_per_su || 8;
      const su = Math.max(1, Math.floor(d.racks / rps));
      setNum("fiber", "su", su);
      setNum("fiber", "racks_per_su", rps);
      setNum("fiber", "rails", v.rails);
      setNum("fiber", "trays_per_rack", v.trays_per_rack);
      setCheck("fiber", "ib_twin_modules",
               String(v.scale_out || "").indexOf("infiniband") === 0);
      const n = [];
      const rem = d.racks - su * rps;
      if (d.racks < rps) n.push("scenario has " + d.racks + " rack(s) < 1 SU (" + rps + " racks) — fiber models whole SUs, showing 1 SU");
      else if (rem > 0) n.push("scenario " + d.racks + " racks = " + su + " SU × " + rps + " + " + rem + " remainder — fiber models whole SUs");
      if (String(v.scale_out || "").indexOf("ethernet") === 0)
        n.push("platform scale-out seeds Ethernet (Spectrum-X class, an [A] design choice; " +
               "the GB200 RA baseline fabric is NDR IB [S]) — single-port pluggables (F-H1); " +
               "re-tick twin-port optics for the IB BOM");
      n.push("leaf/spine/core tier shape stays the 4-SU GB200-RA reference — re-check " +
             "cores/rail and spine-core links for other scales");
      return n;
    },
    cx: (d, v) => {
      setNum("cx", "it_mw", d.it_mw);
      setNum("cx", "pue", v.pue_target);
      const rps = v.racks_per_su || 8;
      setNum("cx", "scalable_units", Math.max(1, Math.floor(d.racks / rps)));
      return [];
    },
    tco: (d, v, s) => {
      setSelect("tco", "platform", s.platform);
      const n = [];
      const diverge = (key, want) => {
        const ctl = document.getElementById("tco." + key);
        if (ctl && ctl.value.trim() !== "" && ctl.dataset.scen !== "1"
            && Number(ctl.value) !== want) {
          n.push("your tco " + key + " field (" + ctl.value + ") overrides the scenario ("
                 + want + ") on this page — clear it to follow the bar");
        }
      };
      if (s.driver === "gpus") {
        clearField("tco", "racks");
        setNum("tco", "gpus", d.gpus);       // gpus wins over racks in the engine
        diverge("gpus", d.gpus);
      } else {
        clearField("tco", "gpus");
        setNum("tco", "racks", d.racks);
        diverge("racks", d.racks);
        diverge("gpus", d.gpus);
      }
      return n;
    },
  };

  function applyAll() {
    if (!scen) return [];
    const d = deriveScenario(scen.platform, scen.driver, scen.target);
    const v = DB[scen.platform];
    let notes = [];
    for (const sec of (A.appState && A.appState.sections) || []) {
      const feed = FEEDS[sec.id];
      if (feed) notes = notes.concat(feed(d, v, scen) || []);
    }
    return notes;
  }
  function clearAll() {
    for (const sec of (A.appState && A.appState.sections) || []) {
      const ids = { power: ["it_mw", "pue", "dist_v", "gpus", "rack_kw", "rack_edpp_kw", "ramp_w_per_sec_per_gpu", "racks_per_path"],
                    cool: ["it_kw", "liquid_frac", "rack_liquid_kw", "cdu_kw", "tcs_inlet_c", "flow_basis"],
                    rack: ["platform", "gpus"],
                    capex: ["platform", "it_mw", "pue"],
                    fiber: ["su", "racks_per_su", "rails", "trays_per_rack", "ib_twin_modules"],
                    cx: ["it_mw", "pue", "scalable_units"],
                    colo: ["it_mw"],
                    neo: ["platform", "it_mw", "gpus"],
                    land: ["it_mw"],
                    plan: ["platform", "gpus"],
                    tco: ["platform", "racks", "gpus"] }[sec.id] || [];
      for (const k of ids) clearField(sec.id, k);
    }
  }

  // ---- hash integration -------------------------------------------------------
  function hashPairs() {
    if (!scen) return [];
    return [["s.platform", scen.platform], ["s.driver", scen.driver], ["s.target", String(scen.target)]];
  }
  // Called by app.js restoreHash BEFORE the field loop. Mutates ps for the
  // legacy-key shim and sets the bar state from s.* (overriding localStorage).
  function restoreFromHash(ps) {
    // Lane-4 back-compat hash aliases (C1/C2/C3/C5): duplicate concept fields
    // normalise at the LINK layer — either spelling of a link keeps working.
    // The engine kwarg names stay frozen (parity/CLI surface); the scenario
    // s.* namespace is the canonical cross-page state carrier.
    const ALIASES = {
      "rack.variant": "rack.platform",                    // C1
      "capex.utilization": "capex.utilisation",           // C2 spelling
      "tco.utilisation": "tco.utilization",
      "power.power_usd_per_kwh": "power.p_e_usd_kwh",     // C3 energy-rate name
      "cx.power_usd_per_kwh": "cx.p_e_usd_kwh",
      "capex.p_e_usd_kwh": "capex.power_usd_per_kwh",
      "tco.p_e_usd_kwh": "tco.power_usd_per_kwh",
      "rack.support_it_frac_of_it": "rack.support_frac",  // C5 support-frac name
      "cx.support_frac": "cx.support_it_frac_of_it",
    };
    for (const [from, to] of Object.entries(ALIASES)) {
      const v = ps.get(from);
      if (v !== null && ps.get(to) === null) ps.set(to, v);
      if (v !== null) ps.delete(from);
    }
    const sp = ps.get("s.platform");
    if (sp && DB[sp]) {
      const s = { platform: sp,
                  driver: ps.get("s.driver") || "racks",
                  target: Number(ps.get("s.target") || 16) };
      if (validScen(s)) { scen = s; save(); }
    } else {
      // bare platform links (the user's tco.html#...platform=... case) seed a
      // SESSION-ONLY scenario: the link's intent wins for THIS page view (even
      // over a stored scenario — antagonist A-03), but merely opening a legacy
      // link never mutates the visitor's own stored scenario (touching the bar
      // afterwards persists it deliberately)
      const plat = ps.get("tco.platform") || ps.get("rack.platform");
      if (plat && DB[plat]) {
        const gpus = Number(ps.get("rack.gpus"));
        const racks = Number(ps.get("tco.racks"));
        const s = gpus > 0 ? { platform: plat, driver: "gpus", target: gpus }
                : { platform: plat, driver: "racks", target: racks > 0 ? racks : 16 };
        if (validScen(s)) scen = s;   // no save() — session-only
      }
    }
    syncBar();
  }
  // Called by app.js registerSections AFTER restoreHash: write the (empty)
  // fields without touching the hash, then the boot render pass reads them.
  function bootApply() {
    if (!scen) return;
    const st = A.appState;
    const was = st.restoring;
    st.restoring = true;
    const notes = applyAll();
    st.restoring = was;
    renderNotes(notes);
  }

  // ---- the bar ------------------------------------------------------------------
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function renderNotes(notes) {
    if (!barEl) return;
    const nl = barEl.querySelector(".scen-notes");
    nl.replaceChildren();
    for (const n of notes || []) {
      const li = el("li", null, n);
      nl.appendChild(li);
    }
    nl.hidden = !notes || !notes.length;
  }
  function syncBar() {
    if (!barEl) return;
    barEl.querySelector(".scen-platform").value = scen ? scen.platform : "";
    barEl.querySelector(".scen-target").value = scen ? String(scen.target) : "";
    for (const r of barEl.querySelectorAll("input[name='scen-driver']")) {
      r.checked = scen ? r.value === scen.driver : r.value === "racks";
    }
    const line = barEl.querySelector(".scen-derived");
    if (scen) {
      const d = deriveScenario(scen.platform, scen.driver, scen.target);
      line.textContent = "→ " + d.racks + " rack" + (d.racks === 1 ? "" : "s") + " · "
        + d.gpus + " GPUs · " + (Math.round(d.it_mw * 1000) / 1000) + " MW-IT nameplate";
    } else {
      line.textContent = "no scenario — each page uses its own defaults";
    }
    barEl.classList.toggle("scen-active", !!scen);
  }
  function onBarChange() {
    const plat = barEl.querySelector(".scen-platform").value;
    if (!plat) {
      scen = null;
      save();
      clearAll();
      syncBar();
      renderNotes([]);
      if (A.scheduleHash) A.scheduleHash();
      return;
    }
    const driver = (barEl.querySelector("input[name='scen-driver']:checked") || {}).value || "racks";
    const tEl = barEl.querySelector(".scen-target");
    let target = Number(tEl.value);
    if (!isFinite(target) || target <= 0) {
      target = driver === "mw" ? 1.0 : driver === "gpus" ? DB[plat].gpus_per_rack * 16 : 16;
      tEl.value = String(target);
    }
    scen = { platform: plat, driver: driver, target: target };
    save();
    syncBar();
    renderNotes(applyAll());
    if (A.scheduleHash) A.scheduleHash();
  }

  function buildScenarioBar() {
    const secs = (A.appState && A.appState.sections) || [];
    scen = loadStored();   // load state FIRST — bootApply works even bar-less
    // mount above the first calculator's input panel (section ELEMENT ids are
    // the v1 anchor names — cooling/racks/commissioning — not the section keys,
    // so anchor off the -inputs mount that buildForm just used)
    const inputs = secs.length && document.getElementById(secs[0].id + "-inputs");
    const host = inputs && (inputs.closest("section") || inputs.parentElement);
    if (!host || document.querySelector(".scenariobar")) return;
    // record every select/checkbox PRISTINE default now (before restoreHash),
    // so hash-restored explicit values are recognised as user values
    for (const sec of secs) {
      for (const f of sec.fields || []) {
        const ctl = document.getElementById(sec.id + "." + f.key);
        if (!ctl) continue;
        if (ctl.tagName === "SELECT" && ctl.dataset.scenDefault === undefined) {
          ctl.dataset.scenDefault = ctl.value;
        }
        if (ctl.type === "checkbox" && ctl.dataset.scenCheckDefault === undefined) {
          ctl.dataset.scenCheckDefault = ctl.checked ? "1" : "";
        }
      }
    }

    const bar = el("div", "scenariobar");
    bar.setAttribute("role", "group");
    bar.setAttribute("aria-label", "Shared scenario — one platform and size drives all calculator pages");
    const title = el("span", "scen-title", "SCENARIO");
    title.title = "Pick a platform and a size once — every calculator page pre-fills consistently. " +
      "Fields you have edited yourself are never overwritten. Carried across pages and in the link.";
    const psel = document.createElement("select");
    psel.className = "scen-platform";
    psel.setAttribute("aria-label", "scenario platform");
    const none = document.createElement("option");
    none.value = "";
    none.textContent = "(no scenario — page defaults)";
    psel.appendChild(none);
    for (const p of PLATFORMS) {
      const o = document.createElement("option");
      o.value = p;
      o.textContent = DB[p].platform;
      psel.appendChild(o);
    }
    const seg = document.createElement("fieldset");
    seg.className = "seg scen-seg";
    const lg = document.createElement("legend");
    lg.textContent = "size by";
    seg.appendChild(lg);
    DRIVERS.forEach(([val, lab], i) => {
      const id = "scen-driver-" + val;
      const r = document.createElement("input");
      r.type = "radio"; r.name = "scen-driver"; r.id = id; r.value = val;
      if (val === "racks") r.checked = true;
      const l = document.createElement("label");
      l.htmlFor = id; l.textContent = lab;
      seg.append(r, l);
    });
    const tgt = document.createElement("input");
    tgt.type = "text";
    tgt.inputMode = "decimal";
    tgt.className = "scen-target";
    tgt.setAttribute("aria-label", "scenario target size");
    tgt.placeholder = "e.g. 16";
    const derived = el("span", "scen-derived");
    derived.setAttribute("aria-live", "polite");
    const notes = document.createElement("ul");
    notes.className = "scen-notes";
    notes.hidden = true;

    const row = el("div", "scen-row");
    row.append(title, psel, seg, tgt, derived);
    bar.append(row, notes);
    psel.addEventListener("change", onBarChange);
    tgt.addEventListener("change", onBarChange);
    seg.addEventListener("change", onBarChange);
    host.insertBefore(bar, host.firstChild);
    barEl = bar;

    // two-way sync: a page's own platform select (rack/tco/capex) updates the
    // scenario — platform is ONE concept everywhere (C1)
    for (const sid of ["rack", "tco", "capex"]) {
      const ctl = document.getElementById(sid + ".platform");
      if (!ctl) continue;
      ctl.addEventListener("change", () => {
        // restore dispatches are not user intent — without this guard a legacy
        // link's field restore overwrote and PERSISTED the visitor's stored
        // scenario platform (antagonist A-03)
        if (applying || (A.appState && A.appState.restoring)) return;
        if (!scen || !ctl.value || !DB[ctl.value] || scen.platform === ctl.value) return;
        scen.platform = ctl.value;
        save();
        syncBar();
        renderNotes(applyAll());
        if (A.scheduleHash) A.scheduleHash();
      });
    }
    syncBar();
  }

  A.scenario = {
    deriveScenario: deriveScenario,
    buildScenarioBar: buildScenarioBar,
    restoreFromHash: restoreFromHash,
    bootApply: bootApply,
    hashPairs: hashPairs,
    current: () => (scen ? Object.assign({}, scen) : null),
    PLATFORMS: PLATFORMS,
  };
})();
