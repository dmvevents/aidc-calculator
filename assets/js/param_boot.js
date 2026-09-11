// Parametric-site section glue (3d.html): platform + GPU inputs -> the
// scenelayout solver (engine-derived counts) -> live stats immediately,
// three.js scene on the explicit "Compute & load 3D" click (dynamic import,
// same vendored-module policy as the detail studio). Follows the shared
// scenario when one is set; the page's own inputs win once touched.
"use strict";
(function () {
  // forward this script's own cache-buster (?v…) to the dynamic import so the
  // viewer module busts in lockstep with the page's asset tag
  const VTAG = (document.currentScript && (document.currentScript.src.split("?")[1] || "")) || "";
  const A = globalThis.AIDC;
  const DB = globalThis.RACKDB;
  if (!A || !DB || !A.sceneLayout) return;

  // F-03: single-source GPU-clamp bounds (hoisted so clampGpuCount and the
  // input-note both bind to ONE ceiling — they cannot drift)
  const LOWER = 512;
  const UPPER = 200000;
  const UPPER_LABEL = UPPER.toLocaleString("en-US");  // en-US grouped label, derived from UPPER

  // F3/DSX-25: the platform list is the variant set, read from RACKDB through
  // AIDC.platforms — NOT a hand-written array. The four-entry array that used
  // to live here hid six of the eleven modelled platforms from this selector.
  const DEFAULT_PLAT = "gb200-nvl72";
  const $ = (id) => document.getElementById(id);
  let viewer = null, viewerMod = null, layerState = {};

  function storedScenario() {
    // 3d.html has no app/scenario pipeline — read the documented localStorage
    // key directly (same contract the scenario bar persists)
    try {
      const s = JSON.parse(localStorage.getItem("aidc.scenario"));
      return (s && DB[s.platform] && Number(s.target) > 0) ? s : null;
    } catch (e) { return null; }
  }
  function deriveGpus(plat, driver, target) {
    const g = DB[plat].gpus_per_rack, k = DB[plat].nameplate_kw;
    const ceilEps = (x) => Math.ceil(x - 1e-9 * Math.max(1, Math.abs(x)));
    let racks;
    if (driver === "gpus") racks = ceilEps(target / g);
    else if (driver === "mw") racks = ceilEps(target * 1000 / k);
    else racks = Math.round(target);
    return Math.max(1, racks) * g;
  }

  function clampGpuCount(n) {
    // F-03: upper clamp to prevent heap-OOM on huge param-gpus values
    // (LOWER/UPPER hoisted to IIFE scope — closed over here)
    if (!(n > 0)) return LOWER;
    if (n > UPPER) return UPPER;
    return Math.round(n);
  }
  function inputNoteFor(gpus, rawNonEmpty) {
    if (rawNonEmpty && !(gpus > 0)) return "GPU count must be ≥ 1 — using 512";               // A-11 (unchanged)
    if (rawNonEmpty && gpus > UPPER) return "GPU count exceeds max (" + UPPER_LABEL + ") — using " + UPPER_LABEL; // F-03
    return null;
  }
  // Expose for testing
  if (typeof module !== "undefined" && module.exports) module.exports = { clampGpuCount, UPPER, LOWER, UPPER_LABEL, inputNoteFor };

  function currentInputs() {
    const scen = storedScenario();
    const platSel = $("param-platform"), gpuInp = $("param-gpus");
    let plat = platSel && platSel.value;
    let gpus = gpuInp && Number(gpuInp.value);
    if ((!plat || !gpus) && scen) {
      const g2 = deriveGpus(scen.platform, scen.driver, Number(scen.target));
      if (!plat) { plat = scen.platform; if (platSel) platSel.value = plat; }
      if (!gpus) { gpus = g2; if (gpuInp) gpuInp.value = String(g2); }
    }
    if (!plat || !DB[plat]) plat = DEFAULT_PLAT;
    let inputNote = inputNoteFor(gpus, !!(gpuInp && gpuInp.value.trim() !== ""));
    if (!gpus || !(gpus > 0)) gpus = 512;
    gpus = clampGpuCount(gpus);
    const shapeSel = $("param-shape");
    const SHAPES = ["auto", "square", "rect-2:1", "rect-3:1", "L", "T"];
    let shape = shapeSel && shapeSel.value;
    if (SHAPES.indexOf(shape) < 0) shape = "auto";
    const rejSel = $("param-rejector");
    const REJ = (A.calcCooling && A.calcCooling.REJECTORS) || ["dry", "tower", "adiabatic"];
    let rej = rejSel && rejSel.value;
    if (REJ.indexOf(rej) < 0) rej = "dry";
    return { plat: plat, gpus: gpus, shape: shape, rej: rej, inputNote: inputNote };
  }

  function renderStats(layout) {
    const host = $("param-stats");
    if (!host) return;
    const frag = document.createDocumentFragment();
    for (const [k, v, chip, cite] of layout.stats) {
      const row = document.createElement("div");
      row.className = "param-row";
      const kk = document.createElement("span");
      kk.className = "param-k";
      kk.textContent = k;
      const vv = document.createElement("span");
      vv.className = "param-v";
      vv.textContent = v + " ";
      const a = document.createElement("a");
      a.className = "chip chip-" + chip.toLowerCase();
      a.href = "sources.html#" + cite;
      a.textContent = chip;
      a.setAttribute("aria-label", (chip === "D" ? "derived" : "assumed") + " — view source");
      vv.appendChild(a);
      row.append(kk, vv);
      frag.appendChild(row);
    }
    host.replaceChildren(frag);
  }

  function recompute() {
    const { plat, gpus, shape, rej, inputNote } = currentInputs();
    const layout = A.sceneLayout.solve(plat, gpus, rej, shape);
    renderStats(layout);
    const host = $("param-stats");
    if (host && inputNote) {
      const w = document.createElement("div");
      w.className = "param-row";
      w.setAttribute("role", "alert");
      const kk = document.createElement("span");
      kk.className = "param-k";
      kk.textContent = "input";
      const vv = document.createElement("span");
      vv.className = "param-v";
      vv.style.color = "var(--bad)";
      vv.textContent = inputNote;
      w.append(kk, vv);
      host.prepend(w);
    }
    if (viewer && viewerMod) {
      viewer.dispose();
      viewer = viewerMod.mount($("param-stage"), layout, layerState);
    }
    return layout;
  }

  async function load3d() {
    const btn = $("param-load");
    if (btn) { btn.disabled = true; btn.textContent = "loading three.js…"; }
    try {
      // dynamic import() in a classic script resolves against THIS script's
      // URL (the documented trap) — sibling path, not page-relative
      viewerMod = await import("./viewer3d_param.js" + (VTAG ? "?" + VTAG : ""));
      const ci = currentInputs();
      const layout = A.sceneLayout.solve(ci.plat, ci.gpus, ci.rej, ci.shape);
      viewer = viewerMod.mount($("param-stage"), layout, layerState);
      if (btn) { btn.textContent = "Recompute"; btn.disabled = false; }
      $("param-stage").classList.add("is-live");
    } catch (e) {
      if (btn) { btn.textContent = "3D failed to load — stats above still live"; }
    }
  }

  function boot() {
    const platSel = $("param-platform");
    if (platSel && !platSel.options.length && A.platforms) {
      // every variant, ordered + availability-badged by the registry; the
      // pre-selection is pinned so widening the list cannot move the default
      A.platforms.populateSelect(platSel, { selectedKey: DEFAULT_PLAT });
    }
    const shapeSel = $("param-shape");
    if (shapeSel && !shapeSel.options.length) {
      for (const [val, label] of [["auto", "auto (default)"],
                                  ["square", "square"],
                                  ["rect-2:1", "rect 2:1"],
                                  ["rect-3:1", "rect 3:1"],
                                  ["L", "L-shape"],
                                  ["T", "T-shape"]]) {
        const o = document.createElement("option");
        o.value = val;
        o.textContent = label;
        shapeSel.appendChild(o);
      }
    }
    const rejSel = $("param-rejector");
    if (rejSel && !rejSel.options.length) {
      for (const [val, label] of [["dry", "dry cooler"],
                                  ["tower", "cooling tower / wetted"],
                                  ["adiabatic", "adiabatic-assist dry"]]) {
        const o = document.createElement("option");
        o.value = val;
        o.textContent = label;
        rejSel.appendChild(o);
      }
    }
    recompute();
    if (platSel) platSel.addEventListener("change", recompute);
    const gpuInp = $("param-gpus");
    if (gpuInp) gpuInp.addEventListener("change", recompute);
    if (shapeSel) shapeSel.addEventListener("change", recompute);
    if (rejSel) rejSel.addEventListener("change", recompute);
    const btn = $("param-load");
    if (btn) btn.addEventListener("click", () => (viewer ? recompute() : load3d()));
    document.querySelectorAll("#param-layers input").forEach((cb) => {
      layerState[cb.dataset.layer] = cb.checked;
      cb.addEventListener("change", () => {
        layerState[cb.dataset.layer] = cb.checked;
        if (viewer) viewer.applyLayers(layerState);
      });
    });
  }

  if (document.readyState === "loading") addEventListener("DOMContentLoaded", boot);
  else boot();
})();
